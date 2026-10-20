use std::collections::{HashMap, HashSet};

use crate::model::{Item, Playable, Repeat};

#[derive(Debug, Clone)]
struct Entry {
    item: Item,
    ordinal: usize,
}

/// Play order plus a cursor. Entries before the cursor are history, so Previous can walk back.
#[derive(Debug, Clone, Default)]
pub struct Queue {
    entries: Vec<Entry>,
    cursor: usize,
    next_ordinal: usize,
    pub shuffle: bool,
    pub repeat: Repeat,
}

impl Queue {
    pub fn new(shuffle: bool, repeat: Repeat) -> Queue {
        Queue {
            shuffle,
            repeat,
            ..Queue::default()
        }
    }

    pub fn replace(&mut self, mut items: Vec<Item>, start_key: Option<&str>) {
        let start = start_key
            .and_then(|key| items.iter().position(|item| item.key == key))
            .unwrap_or(0);
        let last = items.len().saturating_sub(1);
        items.rotate_left(start.min(last));
        self.next_ordinal = items.len();
        self.entries = items
            .into_iter()
            .enumerate()
            .map(|(ordinal, item)| Entry { item, ordinal })
            .collect();
        self.cursor = 0;
        if self.shuffle {
            self.shuffle_upcoming();
        }
    }

    pub fn reconcile(
        &mut self,
        previous_source: &[Item],
        next_source: Vec<Item>,
        mut refresh: impl FnMut(Item) -> Option<Item>,
    ) -> bool {
        let previous_key = self.current().map(|item| item.key.clone());
        let previous_keys: HashSet<&str> = previous_source.iter().map(|item| item.key.as_str()).collect();
        let replacements: HashMap<&str, &Item> = next_source.iter().map(|item| (item.key.as_str(), item)).collect();
        let previous_cursor = self.cursor;
        let mut cursor = None;
        let mut entries = Vec::with_capacity(self.entries.len());
        for (index, mut entry) in std::mem::take(&mut self.entries).into_iter().enumerate() {
            if previous_keys.contains(entry.item.key.as_str()) && !replacements.contains_key(entry.item.key.as_str()) {
                continue;
            }
            let item = replacements
                .get(entry.item.key.as_str())
                .copied()
                .unwrap_or(&entry.item);
            let Some(item) = refresh(item.clone()) else {
                continue;
            };
            entry.item = item;
            if index >= previous_cursor && cursor.is_none() {
                cursor = Some(entries.len());
            }
            entries.push(entry);
        }
        self.entries = entries;
        let next_cursor = self.entries.len();
        // Copies count by occurrence, so a source that gains a second copy of an item queues it, while
        // copies the source already had, or that are queued anyway, aren't added again.
        let mut had: HashMap<&str, usize> = HashMap::new();
        for item in previous_source {
            *had.entry(&item.key).or_default() += 1;
        }
        let mut queued: HashMap<String, usize> = HashMap::new();
        for entry in &self.entries {
            *queued.entry(entry.item.key.clone()).or_default() += 1;
        }
        let mut seen: HashMap<String, usize> = HashMap::new();
        for item in next_source {
            let occurrence = seen.entry(item.key.clone()).or_default();
            *occurrence += 1;
            let present = had.get(item.key.as_str()).copied().unwrap_or(0);
            if *occurrence <= present.max(queued.get(&item.key).copied().unwrap_or(0)) {
                continue;
            }
            if let Some(item) = refresh(item) {
                self.enqueue(item);
            }
        }
        self.cursor = cursor.unwrap_or_else(|| {
            if next_cursor < self.entries.len() || self.repeat == Repeat::Off {
                next_cursor
            } else {
                0
            }
        });
        self.current().map(|item| &item.key) != previous_key.as_ref()
    }

    pub fn current(&self) -> Option<&Item> {
        self.entries.get(self.cursor).map(|entry| &entry.item)
    }

    pub fn set_current_live(&mut self, live: bool) {
        if let Some(entry) = self.entries.get_mut(self.cursor)
            && let Playable::YouTube { live: current, .. } = &mut entry.item.play
        {
            *current = live;
            if live {
                entry.item.duration = None;
            }
        }
    }

    pub fn upcoming(&self) -> impl Iterator<Item = &Item> {
        self.entries.iter().skip(self.cursor + 1).map(|entry| &entry.item)
    }

    /// Where playback goes when the current item finishes on its own.
    pub fn advance(&mut self) -> Option<&Item> {
        if self.repeat == Repeat::One {
            return self.current();
        }
        self.step_forward()
    }

    pub fn next(&mut self) -> Option<&Item> {
        self.step_forward()
    }

    pub fn previous(&mut self) -> Option<&Item> {
        self.cursor = self.cursor.saturating_sub(1);
        self.current()
    }

    fn step_forward(&mut self) -> Option<&Item> {
        if self.cursor + 1 < self.entries.len() {
            self.cursor += 1;
        } else if self.repeat == Repeat::Off || self.entries.is_empty() {
            return None;
        } else {
            self.cursor = 0;
        }
        self.current()
    }

    pub fn enqueue(&mut self, item: Item) {
        self.entries.push(Entry {
            item,
            ordinal: self.next_ordinal,
        });
        self.next_ordinal += 1;
    }

    /// `offset` counts from the first upcoming item.
    pub fn jump(&mut self, offset: usize) -> Option<&Item> {
        let index = self.cursor + 1 + offset;
        (index < self.entries.len()).then(|| {
            self.cursor = index;
        })?;
        self.current()
    }

    pub fn remove_upcoming(&mut self, offset: usize) {
        let index = self.cursor + 1 + offset;
        if index < self.entries.len() {
            self.entries.remove(index);
        }
    }

    /// Moves an upcoming item by `delta` places and returns its new offset.
    pub fn move_upcoming(&mut self, offset: usize, delta: isize) -> usize {
        let upcoming = self.entries.len().saturating_sub(self.cursor + 1);
        if upcoming == 0 {
            return 0;
        }
        let from = offset.min(upcoming - 1);
        let to = from.saturating_add_signed(delta).min(upcoming - 1);
        let entry = self.entries.remove(self.cursor + 1 + from);
        self.entries.insert(self.cursor + 1 + to, entry);
        to
    }

    pub fn set_shuffle(&mut self, shuffle: bool) {
        self.shuffle = shuffle;
        if shuffle {
            self.shuffle_upcoming();
        } else if let Some(upcoming) = self.entries.get_mut(self.cursor + 1..) {
            upcoming.sort_by_key(|entry| entry.ordinal);
        }
    }

    fn shuffle_upcoming(&mut self) {
        if let Some(upcoming) = self.entries.get_mut(self.cursor + 1..) {
            fastrand::shuffle(upcoming);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Playable;

    fn items(keys: &[&str]) -> Vec<Item> {
        keys.iter()
            .map(|key| Item {
                key: key.to_string(),
                title: key.to_string(),
                artist: String::new(),
                duration: None,
                cover: None,
                play: Playable::File { url: String::new() },
            })
            .collect()
    }

    fn keys(queue: &Queue) -> Vec<&str> {
        queue.upcoming().map(|item| item.key.as_str()).collect()
    }

    #[test]
    fn starts_at_the_requested_item_and_wraps_only_with_repeat() {
        let mut queue = Queue {
            repeat: Repeat::Off,
            ..Default::default()
        };
        queue.replace(items(&["a", "b", "c"]), Some("c"));
        assert_eq!(queue.current().unwrap().key, "c");
        assert_eq!(keys(&queue), ["a", "b"]);
        queue.next();
        queue.next();
        assert!(queue.next().is_none());

        queue.repeat = Repeat::All;
        assert_eq!(queue.next().unwrap().key, "c");
        queue.repeat = Repeat::One;
        assert_eq!(queue.advance().unwrap().key, "c");
    }

    #[test]
    fn reordering_and_unshuffling_keep_the_current_item() {
        let mut queue = Queue::default();
        queue.replace(items(&["a", "b", "c", "d"]), None);
        assert_eq!(queue.move_upcoming(2, -2), 0);
        assert_eq!(keys(&queue), ["d", "b", "c"]);

        queue.set_shuffle(true);
        queue.set_shuffle(false);
        assert_eq!(queue.current().unwrap().key, "a");
        assert_eq!(keys(&queue), ["b", "c", "d"]);
    }

    #[test]
    fn unshuffling_a_queue_started_mid_list_keeps_its_wrapped_order() {
        let mut queue = Queue::default();
        queue.replace(items(&["a", "b", "c", "d"]), Some("c"));
        queue.set_shuffle(true);
        queue.set_shuffle(false);
        assert_eq!(keys(&queue), ["d", "a", "b"]);
    }

    #[test]
    fn reconciliation_preserves_edits_and_refreshes_existing_items() {
        let previous = items(&["a", "b", "c", "d"]);
        let mut queue = Queue::default();
        queue.replace(previous.clone(), None);
        queue.remove_upcoming(0);
        queue.move_upcoming(1, -1);
        queue.enqueue(items(&["yt:queued"]).remove(0));
        let mut updated = items(&["a", "b", "c", "d", "e"]);
        updated[1].title = "updated b".into();
        updated[2].title = "updated c".into();

        assert!(!queue.reconcile(&previous, updated, |mut item| {
            if item.key == "yt:queued" {
                item.title = "updated queued".into();
            }
            Some(item)
        }));

        assert_eq!(keys(&queue), ["d", "c", "yt:queued", "e"]);
        assert_eq!(queue.entries[2].item.title, "updated c");
        assert_eq!(queue.entries[3].item.title, "updated queued");
        queue.set_shuffle(false);
        assert_eq!(keys(&queue), ["c", "d", "yt:queued", "e"]);
    }

    #[test]
    fn reconciliation_queues_every_new_copy_of_a_repeated_entry() {
        let previous = items(&["a", "b"]);
        let mut queue = Queue::default();
        queue.replace(previous.clone(), None);

        queue.reconcile(&previous, items(&["a", "b", "b", "c", "c"]), Some);

        assert_eq!(keys(&queue), ["b", "b", "c", "c"]);
    }

    #[test]
    fn reconciliation_replaces_removed_current_and_preserves_history() {
        let previous = items(&["a", "b", "c", "d"]);
        let mut queue = Queue::default();
        queue.replace(previous.clone(), None);
        queue.jump(0);
        assert!(queue.reconcile(&previous, items(&["a", "c", "d"]), Some));
        assert_eq!(queue.current().unwrap().key, "c");
        assert_eq!(queue.previous().unwrap().key, "a");
        queue.jump(1);
        let current_source = items(&["a", "c", "d"]);
        assert!(queue.reconcile(&current_source, items(&["a", "c"]), Some));
        assert!(queue.current().is_none());
        assert_eq!(queue.previous().unwrap().key, "c");

        queue.repeat = Repeat::All;
        assert!(queue.reconcile(&items(&["a", "c"]), items(&["a"]), Some));
        assert_eq!(queue.current().unwrap().key, "a");
        assert!(queue.reconcile(&items(&["a"]), items(&["a", "fresh"]), |_| None));
        assert!(queue.current().is_none());
    }

    #[test]
    fn previous_walks_back_through_history() {
        let mut queue = Queue::default();
        queue.replace(items(&["a", "b", "c"]), None);
        queue.jump(1);
        assert_eq!(queue.current().unwrap().key, "c");
        assert_eq!(queue.previous().unwrap().key, "b");
        assert_eq!(queue.previous().unwrap().key, "a");
        assert_eq!(queue.previous().unwrap().key, "a");
    }

    #[test]
    fn resolved_live_status_replaces_the_saved_playback_metadata() {
        let mut queued = items(&["file", "upcoming"]);
        queued[1].duration = Some(60);
        queued[1].play = Playable::YouTube {
            url: "https://youtu.be/upcoming".into(),
            live: false,
        };
        let mut queue = Queue::default();
        queue.replace(queued, None);
        queue.next();

        queue.set_current_live(true);
        assert!(queue.current().unwrap().is_live());
        assert_eq!(queue.current().unwrap().duration, None);

        queue.set_current_live(false);
        assert!(!queue.current().unwrap().is_live());
        queue.previous();
        queue.set_current_live(true);
        assert!(!queue.current().unwrap().is_live());
    }
}

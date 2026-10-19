use crate::model::{Item, Repeat};

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

    pub fn replace(&mut self, items: Vec<Item>, start_key: Option<&str>) {
        let start = start_key
            .and_then(|key| items.iter().position(|item| item.key == key))
            .unwrap_or(0);
        self.next_ordinal = items.len();
        self.entries = items
            .into_iter()
            .enumerate()
            .map(|(ordinal, item)| Entry { item, ordinal })
            .collect();
        let last = self.entries.len().saturating_sub(1);
        self.entries.rotate_left(start.min(last));
        self.cursor = 0;
        if self.shuffle {
            self.shuffle_upcoming();
        }
    }

    pub fn current(&self) -> Option<&Item> {
        self.entries.get(self.cursor).map(|entry| &entry.item)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
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
    fn previous_walks_back_through_history() {
        let mut queue = Queue::default();
        queue.replace(items(&["a", "b", "c"]), None);
        queue.jump(1);
        assert_eq!(queue.current().unwrap().key, "c");
        assert_eq!(queue.previous().unwrap().key, "b");
        assert_eq!(queue.previous().unwrap().key, "a");
        assert_eq!(queue.previous().unwrap().key, "a");
    }
}

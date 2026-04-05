import { backgroundCatalog } from '@/lib/backgrounds';
import { quotes } from '@/lib/quotes';
import { Background, FocusSession, Task, Track, UserPreferences } from '@/models/app';

type SessionStatus = 'active' | 'completed';

type StoredSession = FocusSession & {
    status: SessionStatus;
};

type UserState = {
    tasks: Task[];
    preferences: UserPreferences;
    sessions: StoredSession[];
};

const trackCatalog: Track[] = [
    {
        id: 'deep-focus-01',
        title: 'Deep Focus Loop',
        artist: 'ChillFlow Radio',
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        duration: 356,
        tags: ['focus', 'instrumental'],
        category: 'focus',
    },
    {
        id: 'ambient-rain-02',
        title: 'Rain Study Session',
        artist: 'ChillFlow Radio',
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        duration: 402,
        tags: ['rain', 'ambient'],
        category: 'ambient',
    },
    {
        id: 'night-drive-03',
        title: 'Night Drive Notes',
        artist: 'ChillFlow Radio',
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        duration: 387,
        tags: ['night', 'creative'],
        category: 'creative',
    },
];

const defaultTasks: Task[] = [
    { id: 'task-1', text: 'Review notes', isCompleted: false, priority: 'medium' },
    { id: 'task-2', text: 'Practice coding', isCompleted: false, priority: 'high' },
    { id: 'task-3', text: 'Write summary', isCompleted: false, priority: 'low' },
];

const defaultPreferences: UserPreferences = {
    defaultMode: 'DeepWork',
    autoPlay: false,
    transitionSpeed: 300,
    volume: 50,
    showNotifications: true,
    theme: 'dark',
    customModes: [],
    selectedTrackId: trackCatalog[0]?.id ?? null,
    selectedBackgroundId: backgroundCatalog[0]?.id ?? null,
    likedTrackIds: [],
};

const userState = new Map<string, UserState>();

function clone<T>(value: T): T {
    return structuredClone(value) as T;
}

function createDefaultState(): UserState {
    return {
        tasks: clone(defaultTasks),
        preferences: clone(defaultPreferences),
        sessions: [],
    };
}

function getUserState(userId: string) {
    const state = userState.get(userId);
    if (state) return state;

    const nextState = createDefaultState();
    userState.set(userId, nextState);
    return nextState;
}

export const appRepository = {
    listTracks() {
        return clone(trackCatalog);
    },

    getTrackById(trackId: string) {
        return clone(trackCatalog.find((track) => track.id === trackId) ?? null);
    },

    listBackgrounds() {
        return clone(backgroundCatalog);
    },

    listQuotes() {
        return clone(quotes);
    },

    listTasks(userId: string) {
        return clone(getUserState(userId).tasks);
    },

    createTask(userId: string, input: Pick<Task, 'text' | 'priority'>) {
        const state = getUserState(userId);
        const task: Task = {
            id: `task-${Date.now()}`,
            text: input.text,
            priority: input.priority,
            isCompleted: false,
            date: new Date(),
        };
        state.tasks.unshift(task);
        return clone(task);
    },

    updateTask(userId: string, taskId: string, input: Partial<Pick<Task, 'text' | 'priority' | 'isCompleted'>>) {
        const state = getUserState(userId);
        const task = state.tasks.find((entry) => entry.id === taskId);
        if (!task) return null;

        Object.assign(task, input);
        return clone(task);
    },

    deleteTask(userId: string, taskId: string) {
        const state = getUserState(userId);
        state.tasks = state.tasks.filter((task) => task.id !== taskId);
        return { success: true };
    },

    getPreferences(userId: string) {
        return {
            preferences: clone(getUserState(userId).preferences),
            backgrounds: clone(backgroundCatalog),
            quotes: clone(quotes),
        };
    },

    updatePreferences(userId: string, input: Partial<UserPreferences>) {
        const state = getUserState(userId);
        state.preferences = {
            ...state.preferences,
            ...input,
        };
        return clone(state.preferences);
    },

    listSessions(userId: string) {
        const sessions = getUserState(userId).sessions
            .filter((session) => session.status === 'completed')
            .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

        return clone(sessions);
    },

    startSession(userId: string, input: Pick<FocusSession, 'mode' | 'durationSeconds' | 'trackId'>) {
        const state = getUserState(userId);
        const session: StoredSession = {
            id: `session-${Date.now()}`,
            mode: input.mode,
            durationSeconds: input.durationSeconds,
            trackId: input.trackId,
            completedAt: new Date().toISOString(),
            status: 'active',
        };
        state.sessions.push(session);
        return clone(session);
    },

    completeSession(userId: string, sessionId: string, durationSeconds?: number) {
        const state = getUserState(userId);
        const session = state.sessions.find((entry) => entry.id === sessionId);
        if (!session) return null;

        session.status = 'completed';
        session.completedAt = new Date().toISOString();
        if (durationSeconds) {
            session.durationSeconds = durationSeconds;
        }

        return clone(session);
    },

    getSessionSummary(userId: string) {
        const sessions = getUserState(userId).sessions.filter((session) => session.status === 'completed');
        const totalSessions = sessions.length;
        const totalMinutes = Math.round(sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / 60);
        const distinctDays = new Set(sessions.map((session) => session.completedAt.slice(0, 10)));

        return {
            totalSessions,
            totalMinutes,
            currentStreak: distinctDays.size,
        };
    },
};

export type AppRepository = typeof appRepository;
export type RepositoryBackground = Background;

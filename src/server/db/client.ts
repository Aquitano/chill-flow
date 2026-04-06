import { appEnv } from '@/lib/env';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export function createDatabase(connectionString: string) {
    return drizzle(neon(connectionString), { schema });
}

export type Database = ReturnType<typeof createDatabase>;

const globalForDatabase = globalThis as typeof globalThis & {
    __chillFlowDatabase?: {
        connectionString: string;
        instance: Database;
    };
};

export function getDatabase(connectionString = appEnv.databaseUrl) {
    if (!connectionString) {
        return null;
    }

    const cachedDatabase = globalForDatabase.__chillFlowDatabase;
    if (cachedDatabase?.connectionString === connectionString) {
        return cachedDatabase.instance;
    }

    const instance = createDatabase(connectionString);
    globalForDatabase.__chillFlowDatabase = {
        connectionString,
        instance,
    };

    return instance;
}

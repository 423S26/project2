//This is the redis hookup, if data is stored in redis, it is considered a "session" and can be used to track user activity and manage sessions. Once a user is done with the session or a specific throw it can be saved in the postgres database for long term storage.
/*
import { createClient } from 'redis';
import config from '@/lib/config';

const redisClient = createClient({
  url: config.env.redisUrl,
})
import { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  PDF_QUEUE: Queue;
  JWT_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
};

export type AppVariables = {
  jwtPayload: {
    id: string;
    email: string;
    role: string;
  };
};
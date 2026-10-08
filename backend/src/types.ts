import { D1Database, R2Bucket } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  JWT_SECRET: string;
};

export type AppVariables = {
  jwtPayload: {
    id: string;
    email: string;
    role: string;
  };
};

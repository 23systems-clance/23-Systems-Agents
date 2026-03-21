import 'express-session';

declare module 'express-session' {
  interface SessionData {
    adminId: string;
    adminName: string;
    adminRole: string;
  }
}

import { withThepopebot } from 'thepopebot/config';

export default withThepopebot({
  experimental: {
    serverActions: {
      allowedOrigins: [
        'ungrieved-charolette-noninitial.ngrok-free.dev',
      ],
    },
  },
  async redirects() {
    return [
      // Developer Portal routes — redirect old bookmarks to /dev/*
      { source: '/clusters/:path*', destination: '/dev/clusters/:path*', permanent: true },
      { source: '/settings/:path*', destination: '/dev/settings/:path*', permanent: true },
      { source: '/runners', destination: '/dev/runners', permanent: true },
      { source: '/chats', destination: '/dev/chats', permanent: true },
      { source: '/notifications', destination: '/dev/notifications', permanent: true },
    ];
  },
});

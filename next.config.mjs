import { withThepopebot } from 'thepopebot/config';

export default withThepopebot({
  experimental: {
    serverActions: {
      allowedOrigins: [
        'ungrieved-charolette-noninitial.ngrok-free.dev',
      ],
    },
  },
});

import { json } from '@sveltejs/kit';

export const GET = () => {
  return json({
    ok: true,
    service: 'brewdial-web',
    version: '0.1.0'
  });
};

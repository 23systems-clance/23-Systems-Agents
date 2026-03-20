export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('23wf/instrumentation');
    await register();
  }
}

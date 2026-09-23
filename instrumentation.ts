// Прогрев тяжёлых расчётов при старте сервера Next.js, чтобы первый клик жюри не ждал перебора.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmUp } = await import("./lib/engine");
  setTimeout(() => {
    const ms = warmUp();
    console.log(`[akim] кэш оптимума и устойчивого плана прогрет за ${ms} мс`);
  }, 300);
}

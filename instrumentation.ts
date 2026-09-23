// Прогрев тяжёлых расчётов при старте сервера Next.js, чтобы первый клик жюри не ждал перебора.
export async function register() {
  // Serverless instances are short lived; warming every one costs more than the
  // first on-demand calculation. Keep the warm-up for the local demo server.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL === "1") return;
  const { warmUp } = await import("./lib/engine");
  setTimeout(() => {
    const ms = warmUp();
    console.log(`[akim] кэш оптимума и устойчивого плана прогрет за ${ms} мс`);
  }, 300);
}

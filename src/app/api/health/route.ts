import { NextResponse } from "next/server";

function checkEnv(key: string): { key: string; present: boolean; valid: boolean } {
  const value = process.env[key];
  if (!value) return { key, present: false, valid: false };
  if (value === "your_key_here" || value === "sk-your-key-here") return { key, present: true, valid: false };
  return { key, present: true, valid: true };
}

export async function GET() {
  const providers = [
    checkEnv("GOOGLE_API_KEY"),
    checkEnv("OPENROUTER_API_KEY"),
    checkEnv("TAVILY_API_KEY"),
    checkEnv("FMP_API_KEY"),
  ];

  const allOk = providers.every((p) => p.valid);

  return NextResponse.json({
    ok: allOk,
    providers,
    warnings: providers
      .filter((p) => !p.valid)
      .map((p) =>
        p.present
          ? `Provider ${p.key} is set to a placeholder value — update it in .env.local`
          : `Provider ${p.key} is missing — set it in .env.local`,
      ),
  });
}

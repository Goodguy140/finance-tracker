import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth-options";

type Context = {
  params: Promise<{ nextauth: string[] }>;
};

const handler = async (req: NextRequest, ctx: Context) => {
  const options = await getAuthOptions();
  const resolved = { params: await ctx.params };
  return NextAuth(options)(req, resolved);
};

export { handler as GET, handler as POST };

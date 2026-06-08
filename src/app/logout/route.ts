import { redirect } from "next/navigation";
import { logOut } from "@/server/auth";

export async function GET() {
  await logOut();
  redirect("/login");
}

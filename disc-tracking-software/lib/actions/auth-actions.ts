"use server";

import { db } from "@/database/drizzle";
import { usersTable } from "@/database/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { z } from "zod";

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes lockout

// Simple cleanup every hour to prevent memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 60 * 60 * 1000).unref?.(); 
}

function checkRateLimit(identifier: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  // If record exists and we are still within the verify lockout window or just tracking window
  if (record) {
    if (now > record.resetTime) {
      // Time window expired, reset
      rateLimitMap.delete(identifier);
      return { allowed: true };
    }

    if (record.count >= MAX_ATTEMPTS) {
      return {
        allowed: false,
        message: "Woah there! You have tried too many times, please try logging in again in a bit.",
      };
    }
  }

  return { allowed: true };
}

function incrementRateLimit(identifier: string) {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (record) {
    record.count += 1;
    // If we just hit the limit, set the reset time to the lockout duration
    if (record.count >= MAX_ATTEMPTS) {
        record.resetTime = now + LOCKOUT_DURATION;
    } 
    // Otherwise keep the existing reset time (or extend it? Simple fixed window: keep existing)
    // Actually, let's just refresh the window on every failed attempt to keep it simple or implement a sliding window.
    // For this requirement "try ... in a bit", a fixed lockout after N attempts is standard.
  } else {
    // New record, expires in 15 minutes (or shorter for just attempts window?)
    // Let's say attempts must happen within 15 mins.
    rateLimitMap.set(identifier, { count: 1, resetTime: now + LOCKOUT_DURATION });
  }
}

// --- Validation Schemas ---
const signInSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(1, { message: "Password is required" }),
});

const signUpSchema = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
  confirmPassword: z.string().min(1, { message: "Confirm Password is required" }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type AuthState = {
  error?: string;
  success?: boolean;
};

export async function signInAction(prevState: AuthState | undefined, formData: FormData): Promise<AuthState> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = signInSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { error: "Invalid email or password format." };
  }

  const { email, password } = validatedFields.data;
  const ipOrEmail = email; // Ideally request ip, but in server action context we rely on identifer

  // Rate Limit Check
  const limit = checkRateLimit(ipOrEmail);
  if (!limit.allowed) {
    return { error: limit.message };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false, // We handle redirection on client or via next/navigation if needed, but signIn throws
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      incrementRateLimit(ipOrEmail); // Failed attempt
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Email or password is incorrect." };
        default:
          return { error: "Something went wrong." };
      }
    }
    // NextAuth throws a redirect error on success, we need to rethrow it
    throw error;
  }
}

export async function signUpAction(prevState: AuthState | undefined, formData: FormData): Promise<AuthState> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = signUpSchema.safeParse(rawData);

  if (!validatedFields.success) {
     const errorMessages = validatedFields.error.issues.map(e => e.message).join(", ");
     return { error: errorMessages };
  }

  const { firstName, lastName, email, password } = validatedFields.data;
  const fullName = `${firstName} ${lastName}`.trim();

  try {
    // Check if user exists
    const existingUser = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return { error: "Error creating account please check credentials" };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    await db.insert(usersTable).values({
      full_name: fullName,
      email: email,
      password: hashedPassword,
    });

    // Auto sign-in after creation? Or redirect to login? 
    
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    
    return { success: true };

  } catch (error) {
    if (error instanceof AuthError) {
       return { error: "Account created but failed to sign in automatically." };
    }
    console.error("Signup error:", error);
    return { error: "Failed to create account. Please try again." };
  }
}

export async function getUserNameAction() {
  const { unstable_noStore: noStore } = await import("next/cache");
  noStore();
  const { auth } = await import("@/auth");
  const session = await auth();
  return session?.user?.name || null;
}

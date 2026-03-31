"use server";

import { db } from "@/database/drizzle";
import { usersTable } from "@/database/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { signupSchema, signinSchema } from "@/lib/validations";
// Import z from zod might be needed if implicit types used, but schemas are imported.

// --- Rate Limiting (Simple In-Memory) ---
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes lockout

// Simple cleanup every hour
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

  if (record) {
    if (now > record.resetTime) {
      rateLimitMap.delete(identifier);
      return { allowed: true };
    }
    if (record.count >= MAX_ATTEMPTS) {
      return {
        allowed: false,
        message: "Too many login attempts. Please try again later.",
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
    if (record.count >= MAX_ATTEMPTS) {
        record.resetTime = now + LOCKOUT_DURATION;
    }
  } else {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + LOCKOUT_DURATION });
  }
}

export const signInWithCredentials = async (params: any) => {
  const validation = signinSchema.safeParse(params);
  if (!validation.success) {
      return { success: false, error: validation.error.issues[0].message };
  }

  const { email, password } = validation.data;
  
  const limit = checkRateLimit(email);
  if (!limit.allowed) {
    return { success: false, error: limit.message };
  }

  try {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      incrementRateLimit(email);
      switch (error.type) {
        case "CredentialsSignin":
          return { success: false, error: "Invalid credentials" };
        default:
          return { success: false, error: "Something went wrong" };
      }
    }
    throw error;
  }
};

export const signUp = async (params: any) => {
  const validation = signupSchema.safeParse(params);
  
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { full_name, email, password, phone } = validation.data;

  try {
    const existingUser = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`)
      .limit(1);

    if (existingUser.length > 0) {
      return { success: false, error: "User already exists" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.insert(usersTable).values({
      full_name,
      email,
      password: hashedPassword,
      phone,
    });

    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
        return { success: false, error: "Account created but failed to sign in automatically." };
    }
    console.error(error); 
    return { success: false, error: "Signup error" };
  }
};

  export const signOutUser = async () => {
    await signOut();
 }
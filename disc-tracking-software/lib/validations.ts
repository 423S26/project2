import { z } from "zod";

const emailSchema = z.string().trim().email("Invalid email address").transform((email) => email.toLowerCase());

export const signupSchema = z.object({
  full_name: z.string().min(3, "Name must be at least 3 characters"),
  email: emailSchema,
  phone: z.string().min(10, "Phone number must be at least 10 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm_password: z.string().min(8, "Password must be at least 8 characters"),
}).refine((data) => data.password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

export const signinSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(3, "Name must be at least 3 characters"),
  email: emailSchema,
  image: z.string().optional(),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

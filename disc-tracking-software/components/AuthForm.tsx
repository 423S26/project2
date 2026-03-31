"use client";

import React, { useState } from 'react';
import { useForm, FieldValues, Path, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z, ZodType } from 'zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Lock, Unlock, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface AuthFormProps<T extends FieldValues> {
  type: 'SIGN_IN' | 'SIGN_UP';
  schema: ZodType<T>;
  defaultValues: T;
  onSubmit: (data: T) => Promise<{ success: boolean; error?: string }>;
}

const AuthForm = <T extends FieldValues>({ type, schema, defaultValues, onSubmit }: AuthFormProps<T>) => {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const form = useForm<T>({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues as any, // Cast defaultValues to satisfy DeepPartial constraint if strict
  });

  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  const submitHandler: SubmitHandler<T> = async (data) => {
    try {
      const response = await onSubmit(data);

      if (response?.error) {
        toast.error(response.error);
      } else {
        toast.success(type === 'SIGN_IN' ? 'Signed in successfully' : 'Account created successfully');
        router.push('/dashboard'); 
      }
    } catch (error) {
      toast.error('Something went wrong. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {type === 'SIGN_IN' ? 'Sign In' : 'Create Account'}
        </h1>
        <p className="text-slate-500">
          {type === 'SIGN_IN' 
            ? 'Welcome back! Please enter your details.' 
            : 'Enter your information to get started.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(submitHandler)} className="space-y-4">
        
        {type === 'SIGN_UP' && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/90">Full Name</label>
              <input 
                {...register('full_name' as Path<T>)}
                placeholder="John Doe" 
                className="w-full p-2.5 bg-[#101835] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#54c4c3] focus:ring-1 focus:ring-[#54c4c3] transition-colors" 
              />
              {errors['full_name'] && (
                <p className="text-red-500 text-xs mt-1">{(errors['full_name'] as any)?.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/90">Phone Number</label>
              <input 
                {...register('phone' as Path<T>)}
                placeholder="+1 (555) 000-0000" 
                className="w-full p-2.5 bg-[#101835] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#54c4c3] focus:ring-1 focus:ring-[#54c4c3] transition-colors" 
              />
              {errors['phone'] && (
                <p className="text-red-500 text-xs mt-1">{(errors['phone'] as any)?.message}</p>
              )}
            </div>
          </>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-white/90">Email</label>
          <input 
            {...register('email' as Path<T>)}
            type="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="email@example.com" 
            className="w-full p-2.5 bg-[#101835] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#54c4c3] focus:ring-1 focus:ring-[#54c4c3] transition-colors"
          />
          {errors['email'] && (
            <p className="text-red-500 text-xs mt-1">{(errors['email'] as any)?.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-white/90">Password</label>
          <div className="relative">
            <input 
              {...register('password' as Path<T>)}
              type={showPassword ? "text" : "password"}
              placeholder="Please enter a password"
              className="w-full p-2.5 bg-[#101835] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#54c4c3] focus:ring-1 focus:ring-[#54c4c3] transition-colors pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              {showPassword ? <Unlock size={16} /> : <Lock size={16} />}
            </button>
          </div>
          {errors['password'] && (
            <p className="text-red-500 text-xs mt-1">{(errors['password'] as any)?.message}</p>
          )}
        </div>

        {type === 'SIGN_UP' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/90">Confirm Password</label>
            <div className="relative">
              <input 
                {...register('confirm_password' as Path<T>)}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Please confirm your password"
                className="w-full p-2.5 bg-[#101835] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#54c4c3] focus:ring-1 focus:ring-[#54c4c3] transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors cursor-pointer"
              >
                {showConfirmPassword ? <Unlock size={16} /> : <Lock size={16} />}
              </button>
            </div>
            {errors['confirm_password'] && (
              <p className="text-red-500 text-xs mt-1">{(errors['confirm_password'] as any)?.message}</p>
            )}
          </div>
        )}

        <button 
          type="submit" 
          disabled={isSubmitting}
          className="w-full bg-[#456fb6] text-white py-2.5 rounded-lg hover:bg-[#365a9c] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" size={16} />
              {type === 'SIGN_IN' ? 'Signing in...' : 'Creating account...'}
            </>
          ) : (
            type === 'SIGN_IN' ? 'Sign In' : 'Create Account'
          )}
        </button>
      </form>
      
      <div className="text-center text-sm text-white/60">
        {type === 'SIGN_IN' ? (
            <>
                Don't have an account?{" "}
                <Link href="/create-account" className="text-[#54c4c3] hover:underline hover:text-[#3daaa9] transition-colors">
                Sign up
                </Link>
            </>
        ) : (
            <>
                Already have an account?{" "}
                <Link href="/sign-in" className="text-[#54c4c3] hover:underline hover:text-[#3daaa9] transition-colors">
                Sign in
                </Link>
            </>
        )}
      </div>
    </div>
  );
};

export default AuthForm;

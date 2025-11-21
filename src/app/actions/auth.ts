'use server';

import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  phone: z.string().optional(),
});

export async function login(prevState: unknown, formData: FormData) {
  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    // User doesn't exist or is a guest (no password)
    return { error: 'Incorrect email or password. Please try again.' };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: 'Incorrect email or password. Please try again.' };
  }

  await createSession(user.id, user.role);
  
  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect('/');
  }
}

export async function register(prevState: unknown, formData: FormData) {
  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { email, password, name, phone } = result.data;

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    if (existingUser.password) {
      return { error: 'This email is already registered. Please sign in instead.' };
    } else {
      // Guest user registering
      const hashedPassword = await hashPassword(password);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          password: hashedPassword,
          name,
          phone,
        },
      });
      await createSession(existingUser.id, existingUser.role);
      redirect('/');
    }
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      phone,
      role: 'USER',
    },
  });

  await createSession(user.id, user.role);
  redirect('/');
}

export async function logout() {
  await deleteSession();
  redirect('/');
}


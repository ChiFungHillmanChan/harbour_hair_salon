'use server';

import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
});

export async function login(prevState: any, formData: FormData) {
  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: 'Invalid fields' };
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    // User doesn't exist or is a guest (no password)
    return { error: 'Invalid credentials' };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: 'Invalid credentials' };
  }

  await createSession(user.id, user.role);
  
  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect('/');
  }
}

export async function register(prevState: any, formData: FormData) {
  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: 'Invalid fields' };
  }

  const { email, password, name, phone } = result.data;

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    if (existingUser.password) {
      return { error: 'User already exists' };
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


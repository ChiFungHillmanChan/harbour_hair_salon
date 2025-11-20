import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/app/lib/password';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: npx tsx prisma/create-admin.ts <name> <email> <password>');
    process.exit(1);
  }

  const [name, email, password] = args;

  console.log(`Creating admin user: ${name} (${email})...`);

  try {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    const hashedPassword = await hashPassword(password);

    if (existingUser) {
      console.log('User already exists. Updating role to ADMIN...');
      await prisma.user.update({
        where: { email },
        data: {
          role: 'ADMIN',
          password: hashedPassword, // Update password just in case
          name: name,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: 'ADMIN',
        },
      });
    }

    console.log('✅ Admin user created/updated successfully.');
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


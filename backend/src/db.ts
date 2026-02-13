import { PrismaClient } from '../generated/prisma/client'

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
})

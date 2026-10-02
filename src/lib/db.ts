import "server-only";
import { PrismaClient } from "@prisma/client";

// Singleton — never `new PrismaClient()` elsewhere (build-health grep gate).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

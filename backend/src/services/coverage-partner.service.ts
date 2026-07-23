import { prisma } from "../db/prisma";
import { AppError } from "../utils/errors";
import { recordAudit } from "./audit.service";
import { rebuildCoverageSnapshot } from "./coverage-snapshot.service";
import type { CoveragePartner } from "../generated/prisma/client";

/** Visao publica do parceiro: sem dados internos de armazenamento. */
export interface PublicCoveragePartner {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  layerCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicPartner(
  partner: CoveragePartner & { _count?: { layers: number } }
): PublicCoveragePartner {
  return {
    id: partner.id,
    name: partner.name,
    code: partner.code,
    description: partner.description,
    active: partner.active,
    layerCount: partner._count?.layers,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
  };
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

async function getPartnerOrThrow(id: string): Promise<CoveragePartner> {
  const partner = await prisma.coveragePartner.findUnique({ where: { id } });
  if (!partner) {
    throw new AppError("COVERAGE_PARTNER_NOT_FOUND", "Parceiro não encontrado.", 404);
  }
  return partner;
}

export async function createPartner(
  input: { name: string; code: string; description?: string; active?: boolean },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicCoveragePartner> {
  const code = normalizeCode(input.code);
  const existing = await prisma.coveragePartner.findUnique({ where: { code } });
  if (existing) {
    throw new AppError("COVERAGE_PARTNER_CODE_IN_USE", "Já existe um parceiro com este código.", 409);
  }
  const partner = await prisma.coveragePartner.create({
    data: {
      name: input.name.trim(),
      code,
      description: input.description?.trim() || null,
      active: input.active ?? true,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });
  await recordAudit({
    userId: actor.id,
    action: "COVERAGE_PARTNER_CREATED",
    entity: "coverage_partner",
    entityId: partner.id,
    metadata: { name: partner.name, partnerCode: partner.code },
    ipAddress,
  });
  return toPublicPartner(partner);
}

export async function listPartners(filters: {
  search?: string;
  active?: boolean;
  page: number;
  limit: number;
}): Promise<{ partners: PublicCoveragePartner[]; total: number; page: number; limit: number }> {
  const where = {
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { code: { contains: filters.search.toUpperCase() } },
          ],
        }
      : {}),
  };
  const [total, partners] = await Promise.all([
    prisma.coveragePartner.count({ where }),
    prisma.coveragePartner.findMany({
      where,
      include: { _count: { select: { layers: true } } },
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    partners: partners.map(toPublicPartner),
    total,
    page: filters.page,
    limit: filters.limit,
  };
}

export async function getPartner(id: string): Promise<PublicCoveragePartner> {
  const partner = await prisma.coveragePartner.findUnique({
    where: { id },
    include: { _count: { select: { layers: true } } },
  });
  if (!partner) {
    throw new AppError("COVERAGE_PARTNER_NOT_FOUND", "Parceiro não encontrado.", 404);
  }
  return toPublicPartner(partner);
}

export async function updatePartner(
  id: string,
  input: { name?: string; code?: string; description?: string | null },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicCoveragePartner> {
  await getPartnerOrThrow(id);
  const code = input.code !== undefined ? normalizeCode(input.code) : undefined;
  if (code) {
    const existing = await prisma.coveragePartner.findUnique({ where: { code } });
    if (existing && existing.id !== id) {
      throw new AppError("COVERAGE_PARTNER_CODE_IN_USE", "Já existe um parceiro com este código.", 409);
    }
  }
  const partner = await prisma.coveragePartner.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      updatedById: actor.id,
    },
  });
  await recordAudit({
    userId: actor.id,
    action: "COVERAGE_PARTNER_UPDATED",
    entity: "coverage_partner",
    entityId: id,
    metadata: { name: partner.name, partnerCode: partner.code },
    ipAddress,
  });
  // Nome do parceiro aparece nos matches: refletir no snapshot.
  await rebuildCoverageSnapshot().catch(() => undefined);
  return toPublicPartner(partner);
}

export async function setPartnerStatus(
  id: string,
  active: boolean,
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicCoveragePartner> {
  await getPartnerOrThrow(id);
  const partner = await prisma.coveragePartner.update({
    where: { id },
    data: { active, updatedById: actor.id },
  });
  await recordAudit({
    userId: actor.id,
    action: active ? "COVERAGE_PARTNER_ACTIVATED" : "COVERAGE_PARTNER_DEACTIVATED",
    entity: "coverage_partner",
    entityId: id,
    metadata: { name: partner.name, partnerCode: partner.code },
    ipAddress,
  });
  await rebuildCoverageSnapshot();
  return toPublicPartner(partner);
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { promises as fs } from "fs";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { storageRoot } from "../src/services/coverage-storage.service";
import {
  hashNormalizedAddress,
  issueLocationConfirmationToken,
} from "../src/services/location-confirmation.service";
import { normalizeAddressInput } from "../src/services/address.service";
import {
  createTestUser,
  loginAs,
  POINT_INSIDE_BARREIRO,
  readFixtureKml,
  resetAppDatabase,
} from "./helpers";

const app = createApp();

const ADDRESS = {
  postalCode: "30640-000",
  street: "Rua Exemplo",
  number: "100",
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
};

let adminToken = "";
let operatorToken = "";
let operatorId = "";
let otherUserId = "";

const ORIGINAL_GEOCODING = {
  provider: "google",
  formattedAddress: "Rua Exemplo, 100 - Barreiro, Belo Horizonte - MG, Brasil",
  confidence: "MEDIUM" as const,
  partialMatch: true,
  locationType: "RANGE_INTERPOLATED" as const,
  latitude: -19.98765,
  longitude: -44.01789,
};

function validToken(userId = operatorId, address: Record<string, unknown> = ADDRESS) {
  return issueLocationConfirmationToken({
    userId,
    address: normalizeAddressInput({ ...address, country: "Brasil" } as never),
    geocoding: ORIGINAL_GEOCODING,
  });
}

function confirm(body: Record<string, unknown>) {
  return request(app)
    .post("/api/viabilities/confirm-location")
    .set("Authorization", `Bearer ${operatorToken}`)
    .send(body);
}

beforeAll(async () => {
  await resetAppDatabase();
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await fs.rm(storageRoot(), { recursive: true, force: true });

  const admin = await createTestUser({ role: "ADMIN", email: "tok-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "tok-op@teste.local" });
  const other = await createTestUser({ role: "OPERATOR", email: "tok-other@teste.local" });
  operatorId = operator.id;
  otherUserId = other.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;

  const partner = await request(app)
    .post("/api/coverage/partners")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Rede Neutra", code: "REDE_NEUTRA" });
  await request(app)
    .post("/api/coverage/layers")
    .set("Authorization", `Bearer ${adminToken}`)
    .field("partnerId", partner.body.partner.id)
    .field("name", "Cobertura Barreiro")
    .attach("file", Buffer.from(readFixtureKml()), "cobertura.kml");
});

afterAll(async () => {
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await resetAppDatabase();
  await disconnectAppDatabase();
});

beforeEach(async () => {
  await prisma.viabilityConsultation.deleteMany();
  await prisma.auditLog.deleteMany();
});

describe("emissão do token", () => {
  it("o /check devolve locationConfirmationToken sempre que geocodifica (ajuste voluntário incluído)", async () => {
    const res = await request(app)
      .post("/api/viabilities/check")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ address: ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ADDRESS_AMBIGUOUS"); // provider dev
    expect(typeof res.body.locationConfirmationToken).toBe("string");
    // Token opaco: o conteúdo é assinado; o frontend não precisa (nem deve) interpretá-lo.
    const decoded = jwt.verify(
      res.body.locationConfirmationToken,
      env.LOCATION_CONFIRMATION_SECRET
    ) as Record<string, unknown>;
    expect(decoded.purpose).toBe("location-confirmation");
    expect(decoded.sub).toBe(operatorId);
    expect(decoded.addressHash).toBe(
      hashNormalizedAddress(normalizeAddressInput({ ...ADDRESS, country: "Brasil" } as never))
    );
  });
});

describe("validação do token na confirmação", () => {
  it("token válido: confirma e o histórico preserva a geocodificação ORIGINAL + coordenadas ajustadas", async () => {
    const res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: validToken(),
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PRELIMINARILY_VIABLE");

    const row = await prisma.viabilityConsultation.findFirstOrThrow();
    // Originais (do token):
    expect(row.geocodingProvider).toBe("google");
    expect(row.geocodedAddress).toBe(ORIGINAL_GEOCODING.formattedAddress);
    expect(row.geocodingConfidence).toBe("MEDIUM");
    expect(row.geocodingLocationType).toBe("RANGE_INTERPOLATED");
    expect(row.geocodingPartialMatch).toBe(true);
    expect(row.geocodedLatitude).toBeCloseTo(ORIGINAL_GEOCODING.latitude, 6);
    expect(row.geocodedLongitude).toBeCloseTo(ORIGINAL_GEOCODING.longitude, 6);
    // Ajustadas (escolhidas pelo usuário):
    expect(row.confirmedLatitude).toBeCloseTo(POINT_INSIDE_BARREIRO.latitude, 6);
    expect(row.confirmedLongitude).toBeCloseTo(POINT_INSIDE_BARREIRO.longitude, 6);
    expect(row.locationConfirmedManually).toBe(true);
  });

  it("token ausente, adulterado ou expirado: LOCATION_CONFIRMATION_INVALID sem registro", async () => {
    // Ausente
    let res = await confirm({ address: ADDRESS, adjustedLocation: POINT_INSIDE_BARREIRO });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LOCATION_CONFIRMATION_INVALID");

    // Adulterado (assinatura inválida)
    const tampered = `${validToken().slice(0, -4)}AAAA`;
    res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: tampered,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LOCATION_CONFIRMATION_INVALID");

    // Expirado (assinado com o mesmo segredo, mas exp no passado)
    const expired = jwt.sign(
      {
        purpose: "location-confirmation",
        sub: operatorId,
        addressHash: hashNormalizedAddress(
          normalizeAddressInput({ ...ADDRESS, country: "Brasil" } as never)
        ),
        ...ORIGINAL_GEOCODING,
      },
      env.LOCATION_CONFIRMATION_SECRET,
      { expiresIn: -10 }
    );
    res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: expired,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LOCATION_CONFIRMATION_INVALID");
    // Mensagem de erro não ecoa o token:
    expect(JSON.stringify(res.body)).not.toContain(expired.slice(0, 24));

    expect(await prisma.viabilityConsultation.count()).toBe(0);
  });

  it("token de outro usuário é recusado", async () => {
    const res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: validToken(otherUserId),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LOCATION_CONFIRMATION_INVALID");
  });

  it("token vinculado a outro endereço é recusado", async () => {
    const tokenForOtherAddress = validToken(operatorId, { ...ADDRESS, number: "999" });
    const res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: tokenForOtherAddress,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LOCATION_CONFIRMATION_INVALID");
  });

  it("o token nunca aparece no histórico nem na auditoria", async () => {
    const token = validToken();
    const res = await confirm({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken: token,
    });
    expect(res.status).toBe(200);

    const row = await prisma.viabilityConsultation.findFirstOrThrow();
    const signature = token.split(".")[2];
    expect(JSON.stringify(row)).not.toContain(signature);
    expect(JSON.stringify(row)).not.toContain(token);

    const audits = await prisma.auditLog.findMany();
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(JSON.stringify(audit)).not.toContain(signature);
    }
  });
});

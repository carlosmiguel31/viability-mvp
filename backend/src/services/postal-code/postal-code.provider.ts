import { env } from "../../config/env";
import { PostalCodeAddress, PostalCodeProvider } from "../../types/address.types";
import { logger } from "../../utils/logger";

/**
 * Consulta de CEP desacoplada da logica de viabilidade.
 * Implementacao padrao: ViaCEP (https://viacep.com.br), servico publico
 * brasileiro sem chave. Falha ou CEP inexistente → null (o frontend permite
 * o preenchimento manual; nada e bloqueado).
 */
export class ViaCepProvider implements PostalCodeProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async findAddressByPostalCode(postalCode: string): Promise<PostalCodeAddress | null> {
    const digits = postalCode.replace(/\D/g, "");
    if (digits.length !== 8) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.POSTAL_CODE_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(`https://viacep.com.br/ws/${digits}/json/`, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        erro?: boolean | string;
        cep?: string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (body.erro) return null;
      return {
        postalCode: digits,
        street: body.logradouro?.trim() || null,
        neighborhood: body.bairro?.trim() || null,
        city: body.localidade?.trim() || null,
        state: body.uf?.trim().toUpperCase() || null,
      };
    } catch {
      // Servico indisponivel nao pode impedir a digitacao manual.
      logger.warn("Servico de CEP indisponivel");
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const postalCodeProvider: PostalCodeProvider = new ViaCepProvider();

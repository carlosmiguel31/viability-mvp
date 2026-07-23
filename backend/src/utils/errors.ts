export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CoverageFileNotFoundError extends AppError {
  constructor(path: string) {
    super("COVERAGE_FILE_NOT_FOUND", `Arquivo de cobertura nao encontrado: ${path}`, 500);
  }
}

export class InvalidCoverageFileError extends AppError {
  constructor(reason: string) {
    super("COVERAGE_FILE_INVALID", `Arquivo de cobertura invalido: ${reason}`, 422);
  }
}

export class VoalleNotConfiguredError extends AppError {
  constructor() {
    super(
      "VOALLE_NOT_CONFIGURED",
      "A conexao com o Voalle ainda nao foi configurada. Defina as variaveis VOALLE_DB_* no ambiente.",
      503
    );
  }
}

export class VoalleUnavailableError extends AppError {
  constructor() {
    super("VOALLE_UNAVAILABLE", "O banco do Voalle esta indisponivel no momento.", 503);
  }
}

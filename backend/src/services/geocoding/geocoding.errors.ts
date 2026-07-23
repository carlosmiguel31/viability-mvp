import { AppError } from "../../utils/errors";

export class AddressNotFoundError extends AppError {
  constructor() {
    super("ADDRESS_NOT_FOUND", "O endereço informado não foi localizado.", 200);
  }
}

export class GeocodingUnavailableError extends AppError {
  constructor() {
    super(
      "GEOCODING_UNAVAILABLE",
      "O serviço de localização de endereços está indisponível no momento.",
      200
    );
  }
}

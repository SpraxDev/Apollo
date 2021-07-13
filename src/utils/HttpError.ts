export class HttpError extends Error {
  readonly httpCode: number;

  constructor(message: string, httpCode: number) {
    super(message);

    this.httpCode = httpCode;
  }
}

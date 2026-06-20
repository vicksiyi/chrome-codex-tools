export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function httpError(statusCode: number, message: string) {
  return new HttpError(statusCode, message);
}

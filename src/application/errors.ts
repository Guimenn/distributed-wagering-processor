/** Erros que viram status HTTP (ver http/error-filter.ts). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const validationError = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);
export const notFound = (what: string, id: string) => new AppError(404, `${what}_NOT_FOUND`, `${what} ${id} not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

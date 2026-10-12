export function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode ?? error.status ?? 500;
  const message = error.message ?? 'Internal server error.';

  return res.status(statusCode).json({
    success: false,
    message,
  });
}

export default errorHandler;

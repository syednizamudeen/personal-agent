// Express 4 does not await async handlers, so a rejected promise inside one
// becomes an unhandled rejection instead of reaching the error middleware.
// Wrap every async route handler in this.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;

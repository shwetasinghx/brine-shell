function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
}

module.exports = { errorHandler };

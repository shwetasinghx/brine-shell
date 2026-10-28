const express = require('express');
const { shareLanding } = require('../controllers/share.controller');

const router = express.Router();
router.get('/:id', shareLanding);

module.exports = router;

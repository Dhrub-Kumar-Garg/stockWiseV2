#!/bin/bash
curl -s -H "Authorization: Bearer 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" \
  https://api.groq.com/openai/v1/models \
  | grep -oP '"id":"[^"]+"' | head -30

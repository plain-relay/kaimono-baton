// Golden compatibility fixtures. These strings model already-published data.
// Never regenerate them from the current encoders inside a test. Changing a
// fixture requires an explicit compatibility decision and migration review.
export const PUBLISHED_V1_REQUEST_FIXTURE =
  'N4IgTgpgjgrhDOAXAkgExALhAGwgcwEMBjATwFpJYFEQAaERAS0V0xEFO5QWSVA7BkFz5QHgy6IIpAKIIqAII0sAJgAMsgGxl5AdlUBGACrz5GPQfkA6PfIBaQ5hAC28TAG1QjdFlyFSZazaEAHMAD2qDBEKK4gNozYANZ+gcGhAHIENhAAygB2BL7wABYBMiCA2k6AznJCRGL4AWAkaJnZeQVs+HjwZKgEjDXllXjVJMmp9Tn5hYCuyoDfDCWAvxGAgypCsAQZTIgkmJr0MBnMbIA05kKpNgFsgHLygECBgFUBVkQBGcONhYB8G4Dau0Lw1YgA8mCoEGD3o0wankmgAvgBdUFAA'

export const PUBLISHED_V2_REQUEST_FIXTURE =
  'NoJgNARA5g9gNgEwKYDsC0A3EaQAYQBsuA7IRJIDaKg0alaC58oDwZ5EI5wukgUsqCRzhALpjBgEQN9pgAxsmLSIBpzJoA1lAMx9evIA'

export const PUBLISHED_V3_REQUEST_FIXTURE =
  'NoZgNARA5g9gNgEwKYDsC0A3EaBMAGHANjwHYiJJApBkBMGQaQZARBkCuGQToZAJhguGDzG4hwoiApZUCRzhAC6YYAEZIAWwCWcANYDAgAmBD+UAuCoDsGQNpOgZzkB-SIEaGQD8MzClN6A5eUBAgYCqA8ZJkQAFjACuAZyQfEAFxSOCBIACwArIQkaEgAHACcAEZoYTgI2ACGkYSpRIRSYVIkYXhlAoBt2oC1etqA6LaAJkqAvBuAAHsCIAKA0RFWroAOUYD-ZoAUrs7SkADGPgAuMLIBeAKAAHKAe2qABgyAigzagGKqgIMqAlICgNAKVuAQ4mJiQA'

export const PUBLISHED_CATALOG_RECOVERY_FIXTURE =
  'N4IgbgpgTgzglgewHYgFwEYA0IDGUICGALhACYCCRaIATAAw0BsAtHQOzNMAqdAzKnToC6AOkF0AWiGw5iBADYIA5mlAwcACwgBbAgDVo8ZGiwh8YOEZSpe2AK4AHUsTKVq9Jqw7cGw4WMEpbARIKCg4UggYVRBtOHkAaxikAm0IakARBkATBkAghkA7BkBtJ0BnOWkQOyQ4KlQQQEWGQGGGQHqGUtkSJQQoAE8ASVJqUnCkBOjsDQjI6yIoOwgAXxnsAlJI0gAFKARSOxwiaNQAbVAI6g0EOxgIE-lSDBpeCAAWAFZGDggADgBOACNme5pSXjMAhPFh-RiMdD3dBse7iUopNLUQBt2oBavUAYqqAQZVSuVKtRANERzRcbU6PT6BHiHVKoyWEGsADMFOcZPgXBQqrQGCx2JxGDx0H5BAFJNinKy3NUPFzvLzfIJ-OIpDMALpzIA'

export const PUBLISHED_CATALOG_RECOVERY_JSON_FIXTURE =
  '{"version":1,"createdAt":"2026-07-26T03:00:00.000Z","catalog":{"schemaVersion":1,"revision":3,"updatedAt":"2026-07-26T02:00:00.000Z","overrides":{"milk":{"name":"いつもの牛乳","unit":"パック","categoryId":"drinks","hidden":true}},"addedProducts":[{"id":"household:123e4567-e89b-42d3-a456-426614174000","name":"家庭商品","unit":"袋","categoryId":"daily","hidden":false,"createdAt":"2026-07-26T01:00:00.000Z","updatedAt":"2026-07-26T02:00:00.000Z"}]}}'

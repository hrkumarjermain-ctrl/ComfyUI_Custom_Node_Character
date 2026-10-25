# Custom values (addition to 5.1.1)

- New optional input **`custom_values`**: your own text for any field the dropdowns do
  not cover, one `field=value` per line, for example `origin_age=24 to 26 years old`,
  `body_type=1.80 m tall` or `origin_ethnicity=Ethiopian Amhara`.
- Each line replaces that field exactly as written, after every random, guidance and
  compatibility rule, the same way as Override text (a custom main garment also
  clears competing garment families). A connected Override text keeps the final word.
  Later lines for the same field win; unknown fields, empty values and `#` lines are
  ignored. `eye_focus` and `mouth_expression` are accepted too.
- A custom ethnicity is used as written: it no longer goes through the
  ethnicity-guidance template, so text with `{` `}` cannot break the prompt and the
  eye colour stays in it.
- Frontend: the input sits in the Custom inputs section and is saved in the node
  properties (`cpf_custom_values`), so the positional values of existing workflows
  are unchanged.
- Tests: `tests/test_custom_values.py`, `tests/test_frontend_custom_values.cjs`.

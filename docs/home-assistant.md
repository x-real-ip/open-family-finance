# Transfer-change notifications in Home Assistant

Open Family Finance can tell you, ahead of time, when your standing orders
have to change for next month: a new transfer, one that ends, or a different
amount, day, IBAN or description. Set the day of the month to be notified on
the **Transfers** page → **Notifications** (default the 20th). From that day
on the API reports the changes; e-mail (if SMTP is configured) goes out on its
own, Home Assistant can pick them up as below.

## The endpoint

`GET /api/notifications/transfers` — with `Authorization: Bearer <API_TOKEN>`
when the API has a token.

```json
{
  "month": "2026-11",
  "nextMonth": "2026-12",
  "notifyDay": 20,
  "due": true,
  "count": 1,
  "title": "1 wijziging(en) in de overboekingen voor december 2026",
  "summary": "• Wijzig KNAB → Raisin · Coen: bedrag € 200,00 → € 250,00",
  "changes": [
    { "kind": "changed", "from": "KNAB", "to": "Raisin · Coen", "amount": 250, "before": 200,
      "day": "25", "iban": "DE17…", "reference": "PLAN…",
      "text": "Wijzig KNAB → Raisin · Coen: bedrag € 200,00 → € 250,00" }
  ]
}
```

`kind` is `added`, `removed` or `changed`. `due` is `true` from the notify day
until the end of the month.

## REST sensor

```yaml
sensor:
  - platform: rest
    name: Overboekingen wijzigingen
    unique_id: open_family_finance_transfer_changes
    resource: http://open-family-finance.tools.svc.cluster.local/api/notifications/transfers
    headers:
      Authorization: !secret open_family_finance_api_auth   # "Bearer <API_TOKEN>"
    value_template: "{{ value_json.count }}"
    json_attributes: [month, nextMonth, notifyDay, due, title, summary, changes]
    scan_interval: 3600
```

## Creating a task

Create a task when `due` is true and the state is above 0, once per
`nextMonth` (keep the last month you created a task for, e.g. in a flow
context variable or an `input_text`).

**Node-RED** (Home Assistant nodes):

1. *Events: state* on `sensor.overboekingen_wijzigingen`, output only when
   the state is above 0.
2. A *function* node that lets it through only when due and not yet done for
   that month:

   ```js
   const a = msg.data.new_state.attributes;
   if (!a.due || flow.get("off_task_month") === a.nextMonth) return null;
   flow.set("off_task_month", a.nextMonth);
   msg.payload = { action: "todo.add_item", target: { entity_id: "todo.taken" },
     data: { item: a.title, description: a.summary } };
   return msg;
   ```

3. An *Action* node (`todo.add_item`) that takes its data from `msg.payload`.

**Without Node-RED**, the same as a Home Assistant automation:

```yaml
automation:
  - alias: Overboekingen aanpassen
    triggers:
      - trigger: state
        entity_id: sensor.overboekingen_wijzigingen
      - trigger: time
        at: "09:00:00"
    conditions:
      - condition: template
        value_template: >
          {{ state_attr('sensor.overboekingen_wijzigingen', 'due')
             and states('sensor.overboekingen_wijzigingen') | int(0) > 0
             and states('input_text.overboekingen_taak_maand') != state_attr('sensor.overboekingen_wijzigingen', 'nextMonth') }}
    actions:
      - action: todo.add_item
        target: { entity_id: todo.taken }
        data:
          item: "{{ state_attr('sensor.overboekingen_wijzigingen', 'title') }}"
          description: "{{ state_attr('sensor.overboekingen_wijzigingen', 'summary') }}"
      - action: input_text.set_value
        target: { entity_id: input_text.overboekingen_taak_maand }
        data: { value: "{{ state_attr('sensor.overboekingen_wijzigingen', 'nextMonth') }}" }
```

Replace `todo.taken` with your own to-do list.

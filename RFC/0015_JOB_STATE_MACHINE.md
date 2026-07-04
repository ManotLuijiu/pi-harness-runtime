# RFC0015 Job State Machine
States: created->planning->queued->running->testing->e2e_testing->reviewing->repairing->paused_quota->waiting_human->ready_for_client->archived
Rules: emit events, checkpoint every transition.
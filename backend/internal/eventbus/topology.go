package eventbus

type ExchangeKind string

const (
	ExchangeKindTopic  ExchangeKind = "topic"
	ExchangeKindDirect ExchangeKind = "direct"
)

const (
	ExchangeDomain    = "surebet.domain"
	ExchangeExecution = "surebet.execution"
	ExchangeAlert     = "surebet.alert"
)

const (
	RoutingOddsUpdated      = "odds.updated"
	RoutingSurebetDetected  = "surebet.detected"
	RoutingValidationPassed = "validation.passed"
	RoutingValidationFailed = "validation.failed"
	RoutingBetRequested     = "bet.requested"
	RoutingBetStarted       = "bet.started"
	RoutingBetAccepted      = "bet.accepted"
	RoutingBetRejected      = "bet.rejected"
	RoutingBetSettled       = "bet.settled"
	RoutingAlertCreated     = "alert.created"
)

type Exchange struct {
	Name    string
	Kind    ExchangeKind
	Durable bool
}

type Queue struct {
	Name                 string
	Durable              bool
	DeadLetterExchange   string
	DeadLetterRoutingKey string
}

type Binding struct {
	Exchange   string
	Queue      string
	RoutingKey string
}

var Exchanges = []Exchange{
	{Name: ExchangeDomain, Kind: ExchangeKindTopic, Durable: true},
	{Name: ExchangeExecution, Kind: ExchangeKindTopic, Durable: true},
	{Name: ExchangeAlert, Kind: ExchangeKindTopic, Durable: true},
}

var Queues = []Queue{
	{Name: "odds.normalizer", Durable: true},
	{Name: "surebet.detector", Durable: true},
	{Name: "validation.pipeline", Durable: true},
	{Name: "execution.requests", Durable: true},
	{Name: "execution.results", Durable: true},
	{Name: "persistence.writer", Durable: true},
	{Name: "websocket.broadcast", Durable: true},
	{Name: "alert.dispatcher", Durable: true},
}

var Bindings = []Binding{
	{Exchange: ExchangeDomain, Queue: "odds.normalizer", RoutingKey: RoutingOddsUpdated},
	{Exchange: ExchangeDomain, Queue: "surebet.detector", RoutingKey: RoutingOddsUpdated},
	{Exchange: ExchangeDomain, Queue: "validation.pipeline", RoutingKey: RoutingSurebetDetected},
	{Exchange: ExchangeDomain, Queue: "persistence.writer", RoutingKey: RoutingValidationFailed},
	{Exchange: ExchangeExecution, Queue: "execution.requests", RoutingKey: RoutingBetRequested},
	{Exchange: ExchangeExecution, Queue: "execution.results", RoutingKey: RoutingBetAccepted},
	{Exchange: ExchangeExecution, Queue: "execution.results", RoutingKey: RoutingBetRejected},
	{Exchange: ExchangeExecution, Queue: "execution.results", RoutingKey: RoutingBetSettled},
	{Exchange: ExchangeExecution, Queue: "persistence.writer", RoutingKey: RoutingBetAccepted},
	{Exchange: ExchangeExecution, Queue: "persistence.writer", RoutingKey: RoutingBetRejected},
	{Exchange: ExchangeExecution, Queue: "persistence.writer", RoutingKey: RoutingBetSettled},
	{Exchange: ExchangeExecution, Queue: "websocket.broadcast", RoutingKey: RoutingBetAccepted},
	{Exchange: ExchangeExecution, Queue: "websocket.broadcast", RoutingKey: RoutingBetRejected},
	{Exchange: ExchangeExecution, Queue: "websocket.broadcast", RoutingKey: RoutingBetSettled},
	{Exchange: ExchangeAlert, Queue: "alert.dispatcher", RoutingKey: RoutingAlertCreated},
	{Exchange: ExchangeAlert, Queue: "websocket.broadcast", RoutingKey: RoutingAlertCreated},
}

func QueueNames() []string {
	names := make([]string, 0, len(Queues))
	for _, queue := range Queues {
		names = append(names, queue.Name)
	}
	return names
}

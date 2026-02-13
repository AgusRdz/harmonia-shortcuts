CONTAINER := harmonia-shortcuts

install: set-executable
	./abin/install.sh

set-executable:
	chmod 755 ./abin/*.sh

npm:
	docker-compose exec $(CONTAINER) npm $(CMD)

npx:
	docker-compose exec $(CONTAINER) npx $(CMD)

package:
	docker-compose exec $(CONTAINER) npx vsce package

build:
	docker-compose exec $(CONTAINER) npm run build

format:
	docker-compose exec $(CONTAINER) npm run format
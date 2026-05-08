.PHONY: help init plan apply destroy output ip ssh deploy logs health stop start

# Resolve the SSH target from terraform outputs (lazy — only invokes terraform when used)
SSH_TARGET = $(shell terraform output -raw ssh_user 2>/dev/null)@$(shell terraform output -raw instance_ip 2>/dev/null)
INSTANCE   = $(shell terraform output -raw instance_name 2>/dev/null)
ZONE       = $(shell terraform output -raw zone 2>/dev/null)
REPO_ROOT  = $(shell git rev-parse --show-toplevel)

help:
	@echo "SandboxJS GCP — common targets"
	@echo ""
	@echo "  Setup:"
	@echo "    make init        Initialize Terraform"
	@echo "    make plan        Preview changes"
	@echo "    make apply       Create/update the VM"
	@echo "    make destroy     Tear everything down (zero ongoing cost)"
	@echo ""
	@echo "  Day-to-day:"
	@echo "    make deploy      Build + rsync code, restart service"
	@echo "    make ssh         SSH into the VM"
	@echo "    make logs        Tail the API service logs"
	@echo "    make health      Hit the /health endpoint"
	@echo "    make ip          Print the public IP"
	@echo "    make output      Show all terraform outputs"
	@echo ""
	@echo "  Cost saving (keeps disk + IP, ~\$$4/mo idle):"
	@echo "    make stop        Stop the instance"
	@echo "    make start       Start the instance"

init:
	terraform init

plan:
	terraform plan

apply:
	terraform apply

destroy:
	terraform destroy

output:
	terraform output

ip:
	@terraform output -raw instance_ip

ssh:
	ssh $(SSH_TARGET)

deploy:
	cd $(REPO_ROOT) && ./infra/deploy/deploy-gcp.sh $(SSH_TARGET)

logs:
	ssh $(SSH_TARGET) sudo journalctl -u sandboxjs-api -f

health:
	@curl -fsS "http://$$(terraform output -raw instance_ip):3000/health" && echo

stop:
	gcloud compute instances stop $(INSTANCE) --zone=$(ZONE)

start:
	gcloud compute instances start $(INSTANCE) --zone=$(ZONE)

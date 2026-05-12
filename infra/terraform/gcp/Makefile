.PHONY: help init plan apply destroy output api-ip worker-ips ssh ssh-worker deploy logs health stop start

# Resolve fleet info from terraform outputs (lazy — only invokes terraform when used)
SSH_USER       = $(shell terraform output -raw ssh_user 2>/dev/null)
API_IP         = $(shell terraform output -raw api_ip 2>/dev/null)
INSTANCE_NAME  = $(shell terraform output -raw instance_name 2>/dev/null)
ZONE           = $(shell terraform output -raw zone 2>/dev/null)
WORKER_COUNT   = $(shell terraform output -raw worker_count 2>/dev/null)
REPO_ROOT      = $(shell git rev-parse --show-toplevel)

# Space-separated list of ubuntu@worker-ip strings, e.g. "ubuntu@1.2.3.4 ubuntu@5.6.7.8"
WORKER_TARGETS = $(shell terraform output -json worker_ips 2>/dev/null | python3 -c "import sys,json; ips=json.load(sys.stdin); user='$(SSH_USER)'; print(' '.join(f'{user}@{ip}' for ip in ips))" 2>/dev/null)
API_TARGET     = $(SSH_USER)@$(API_IP)

help:
	@echo "SandboxJS GCP — common targets"
	@echo ""
	@echo "  Setup:"
	@echo "    make init        Initialize Terraform"
	@echo "    make plan        Preview changes"
	@echo "    make apply       Create/update the fleet (API VM + workers)"
	@echo "    make destroy     Tear everything down"
	@echo ""
	@echo "  Day-to-day:"
	@echo "    make deploy      Build + rsync code, restart services on every VM"
	@echo "    make ssh         SSH into the API server"
	@echo "    make ssh-worker  SSH into the first worker"
	@echo "    make logs        Tail the API service logs"
	@echo "    make health      Hit the /health endpoint"
	@echo "    make api-ip      Print the API server's public IP"
	@echo "    make worker-ips  Print all worker public IPs"
	@echo "    make output      Show all terraform outputs"
	@echo ""
	@echo "  Cost saving:"
	@echo "    make stop        Stop every instance in the fleet"
	@echo "    make start       Start every instance in the fleet"

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

api-ip:
	@terraform output -raw api_ip

worker-ips:
	@terraform output -json worker_ips | python3 -m json.tool

ssh:
	ssh $(API_TARGET)

ssh-worker:
	ssh $(firstword $(WORKER_TARGETS))

deploy:
	cd $(REPO_ROOT) && ./infra/deploy/deploy-gcp.sh $(API_TARGET) $(WORKER_TARGETS)

logs:
	ssh $(API_TARGET) sudo journalctl -u sandboxjs-api -f

health:
	@curl -fsS "http://$$(terraform output -raw api_ip):3000/health" && echo

stop:
	gcloud compute instances stop $(INSTANCE_NAME)-api --zone=$(ZONE)
	@for i in $$(seq 0 $$(( $(WORKER_COUNT) - 1 ))); do \
	  gcloud compute instances stop $(INSTANCE_NAME)-worker-$$i --zone=$(ZONE); \
	done

start:
	gcloud compute instances start $(INSTANCE_NAME)-api --zone=$(ZONE)
	@for i in $$(seq 0 $$(( $(WORKER_COUNT) - 1 ))); do \
	  gcloud compute instances start $(INSTANCE_NAME)-worker-$$i --zone=$(ZONE); \
	done

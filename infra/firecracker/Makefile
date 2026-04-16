.PHONY: all kernel rootfs test-vm clean

all: kernel rootfs

kernel:
	@bash download-kernel.sh

rootfs:
	@sudo bash build-rootfs.sh

test-vm:
	@echo "=== Starting test Firecracker VM ==="
	@mkdir -p /tmp/sandboxjs/firecracker
	@rm -f /tmp/sandboxjs/firecracker/test.sock
	@# Start Firecracker in background
	@firecracker --api-sock /tmp/sandboxjs/firecracker/test.sock &
	@sleep 1
	@# Configure VM
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/machine-config \
		-H 'Content-Type: application/json' \
		-d '{"vcpu_count":1,"mem_size_mib":256}'
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/boot-source \
		-H 'Content-Type: application/json' \
		-d '{"kernel_image_path":"/opt/sandboxjs/vmlinux","boot_args":"console=ttyS0 reboot=k panic=1 pci=off"}'
	@# Copy rootfs for this test VM
	@cp /opt/sandboxjs/rootfs.ext4 /tmp/sandboxjs/firecracker/test-rootfs.ext4
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/drives/rootfs \
		-H 'Content-Type: application/json' \
		-d '{"drive_id":"rootfs","path_on_host":"/tmp/sandboxjs/firecracker/test-rootfs.ext4","is_root_device":true,"is_read_only":false}'
	@# Configure vsock
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/vsock \
		-H 'Content-Type: application/json' \
		-d '{"guest_cid":3,"uds_path":"/tmp/sandboxjs/firecracker/test_v.sock"}'
	@# Start VM
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/actions \
		-H 'Content-Type: application/json' \
		-d '{"action_type":"InstanceStart"}'
	@echo ""
	@echo "VM started. Waiting for guest agent..."
	@sleep 3
	@# Test execution via vsock
	@echo '{"type":"execute","code":"console.log(\"hello from firecracker!\")","timeoutMs":5000}' \
		| socat - UNIX-CONNECT:/tmp/sandboxjs/firecracker/test_v.sock
	@echo ""
	@echo "=== Test complete. Cleaning up... ==="
	@curl -s --unix-socket /tmp/sandboxjs/firecracker/test.sock \
		-X PUT http://localhost/actions \
		-H 'Content-Type: application/json' \
		-d '{"action_type":"SendCtrlAltDel"}' || true
	@sleep 1
	@pkill -f "firecracker.*test.sock" || true
	@rm -f /tmp/sandboxjs/firecracker/test.sock /tmp/sandboxjs/firecracker/test_v.sock /tmp/sandboxjs/firecracker/test-rootfs.ext4

clean:
	rm -f /opt/sandboxjs/vmlinux /opt/sandboxjs/rootfs.ext4
	rm -rf /tmp/sandboxjs/firecracker/*

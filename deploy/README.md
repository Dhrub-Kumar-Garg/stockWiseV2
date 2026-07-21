# StockWise V2 - Oracle Cloud Deployment Guide

This guide covers deploying the StockWise V2 engine and dashboard to an Oracle Cloud "Always Free" instance. 
Once set up, your bot will run 24/7 without needing your laptop to be awake.

## 1. Prepare your GitHub Repository

Since you chose to use GitHub:
1. Go to GitHub and create a **New Repository**. Make it **Private**.
2. Open your terminal in the `fabinvest` folder on your laptop.
3. Link it to GitHub and push your code:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```
   *(Note: You will need a GitHub Personal Access Token to authenticate the push if you don't use SSH).*

## 2. Create the Oracle Cloud Instance

1. Log into your Oracle Cloud dashboard.
2. Go to **Compute** -> **Instances** -> **Create Instance**.
3. Name it (e.g., `stockwise-v2`).
4. **Image and Shape:**
   - Image: Choose **Ubuntu 22.04** or **24.04**.
   - Shape: Click "Change Shape", select **Ampere** (ARM), and pick the **VM.Standard.A1.Flex** shape. You can allocate up to 4 OCPUs and 24 GB of RAM (all Always Free).
5. **Networking:** Ensure "Assign a public IPv4 address" is checked.
6. **SSH Keys:** Save the **Private Key** (you will need this to log in!).
7. Click **Create**.

## 3. Open Ports in Oracle Cloud

Oracle Cloud has a strict firewall in addition to the server's internal firewall. You must open port `3002`.
1. On your Instance details page, click on the **Subnet** link under "Primary VNIC".
2. Click on the **Security List** (e.g., `Default Security List for vcn-...`).
3. Click **Add Ingress Rules**.
4. Set:
   - Source CIDR: `0.0.0.0/0`
   - Destination Port Range: `3002`
   - Description: `StockWise Dashboard`
5. Click **Add Ingress Rules**.

## 4. Connect to the Server

Open a terminal on your laptop and use the private key you downloaded to connect to your server's Public IP:

```bash
# Fix permissions on the private key (Windows requires this sometimes, or use PuTTY)
# Or in PowerShell (if OpenSSH is installed):
ssh -i "path\to\your\private_key.key" ubuntu@YOUR_SERVER_IP
```

## 5. Clone the Repository on the Server

Once logged into the Oracle server (`ubuntu@...`):

```bash
# Clone your repository (you will need to input your GitHub username and Personal Access Token)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git fabinvest
cd fabinvest
```

## 6. Run the Setup Script

The setup script handles Node.js installation, internal firewall config, npm install, Next.js build, and setting up the background services.

```bash
# Ensure the script is executable
chmod +x deploy/setup.sh

# Run the setup script with admin privileges
sudo bash deploy/setup.sh
```

## 7. Verify Everything is Running

The setup script automatically registers two services:
1. `stockwise-engine` (The trading bot)
2. `stockwise-dashboard` (The Next.js UI)

To check the engine logs:
```bash
sudo journalctl -u stockwise-engine -f
```
To check the dashboard logs:
```bash
sudo journalctl -u stockwise-dashboard -f
```

*(Press `Ctrl+C` to exit the logs).*

### Access the Dashboard
Open your mobile browser or laptop browser and go to:
`http://YOUR_SERVER_IP:3002`

If you need to stop or restart the services later:
```bash
sudo systemctl stop stockwise-engine
sudo systemctl start stockwise-engine
```

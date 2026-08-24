package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type config struct {
	ListenAddress   string `json:"listenAddress"`
	ControlPlaneURL string `json:"controlPlaneUrl"`
	EnrollmentToken string `json:"enrollmentToken"`
	TenantID        string `json:"tenantId"`
	ProviderID      string `json:"providerId"`
	NodeID          string `json:"nodeId"`
	Name            string `json:"name"`
	Role            string `json:"role"`
	KeyBackend      string `json:"keyBackend"`
	Exportability   string `json:"exportability"`
	CAKeyPath       string `json:"caKeyPath"`
	CACertPath      string `json:"caCertPath"`
	CAChainPath     string `json:"caChainPath"`
	OpenSSLPath     string `json:"opensslPath"`
	DataDir         string `json:"dataDir"`
}

type server struct {
	config  config
	client  *http.Client
	results map[string]signResponse
	mu      sync.Mutex
}

type signRequest struct {
	CSRPEM            string   `json:"csrPem"`
	SANs              []string `json:"sans"`
	ValidityDays      int      `json:"validityDays"`
	ExtendedKeyUsages []string `json:"extendedKeyUsages"`
	IdempotencyKey    string   `json:"idempotencyKey"`
}

type signResponse struct {
	CertificatePEM             string `json:"certificatePem"`
	CertificateChainPEM        string `json:"certificateChainPem"`
	SerialNumber               string `json:"serialNumber"`
	FingerprintSHA256          string `json:"fingerprintSha256"`
	PublicKeyFingerprintSHA256 string `json:"publicKeyFingerprintSha256"`
	NotBefore                  string `json:"notBefore"`
	NotAfter                   string `json:"notAfter"`
	ProviderRequestID          string `json:"providerRequestId"`
}

func main() {
	configPath := flag.String("config", "ca-node.json", "配置文件路径")
	flag.Parse()
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	node := &server{config: cfg, client: &http.Client{Timeout: 30 * time.Second}, results: map[string]signResponse{}}
	if err := node.loadResults(); err != nil {
		log.Printf("加载幂等结果失败: %v", err)
	}
	if cfg.ControlPlaneURL != "" {
		if cfg.NodeID == "" && cfg.EnrollmentToken != "" {
			if err := node.register(); err != nil {
				log.Fatal(err)
			}
		}
		go node.controlPlaneLoop(context.Background())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", node.health)
	mux.HandleFunc("POST /v1/sign", node.sign)
	mux.HandleFunc("POST /v1/revoke", node.revoke)
	log.Printf("GCAC CA Node listening on %s", cfg.ListenAddress)
	log.Fatal(http.ListenAndServe(cfg.ListenAddress, mux))
}

func loadConfig(path string) (config, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return config{}, err
	}
	var cfg config
	if err := json.Unmarshal(content, &cfg); err != nil {
		return config{}, err
	}
	if cfg.ListenAddress == "" {
		cfg.ListenAddress = "127.0.0.1:9444"
	}
	if cfg.Name == "" {
		cfg.Name, _ = os.Hostname()
	}
	if cfg.Role == "" {
		cfg.Role = "member"
	}
	if cfg.KeyBackend == "" {
		cfg.KeyBackend = "file"
	}
	if cfg.Exportability == "" {
		cfg.Exportability = "exportable"
	}
	if cfg.OpenSSLPath == "" {
		cfg.OpenSSLPath = "openssl"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Join(filepath.Dir(path), "data")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return config{}, err
	}
	return cfg, nil
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "platform": runtime.GOOS, "keyBackend": s.config.KeyBackend,
		"exportability": s.config.Exportability, "nodeId": s.config.NodeID,
	})
}

func (s *server) sign(w http.ResponseWriter, request *http.Request) {
	var input signRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}
	if input.IdempotencyKey == "" || input.CSRPEM == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_FAILED", "csrPem 和 idempotencyKey 必填")
		return
	}
	s.mu.Lock()
	if cached, ok := s.results[input.IdempotencyKey]; ok {
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, cached)
		return
	}
	s.mu.Unlock()
	result, err := s.signCSR(request.Context(), input)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "CA_SIGN_FAILED", err.Error())
		return
	}
	s.mu.Lock()
	s.results[input.IdempotencyKey] = result
	err = s.saveResults()
	s.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "CA_RESULT_PERSIST_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *server) revoke(w http.ResponseWriter, request *http.Request) {
	var input map[string]any
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revokedAt": time.Now().UTC().Format(time.RFC3339), "recorded": true})
}

func (s *server) signCSR(ctx context.Context, input signRequest) (signResponse, error) {
	if s.config.CAKeyPath == "" || s.config.CACertPath == "" {
		return signResponse{}, errors.New("caKeyPath 和 caCertPath 必须配置")
	}
	directory, err := os.MkdirTemp(s.config.DataDir, "sign-")
	if err != nil {
		return signResponse{}, err
	}
	defer os.RemoveAll(directory)
	csrPath := filepath.Join(directory, "request.csr.pem")
	certPath := filepath.Join(directory, "issued.cert.pem")
	extPath := filepath.Join(directory, "leaf.ext.cnf")
	if err := os.WriteFile(csrPath, []byte(input.CSRPEM), 0o600); err != nil {
		return signResponse{}, err
	}
	if err := os.WriteFile(extPath, []byte(extensionConfig(input.SANs, input.ExtendedKeyUsages)), 0o600); err != nil {
		return signResponse{}, err
	}
	serialBytes := make([]byte, 16)
	if _, err := rand.Read(serialBytes); err != nil {
		return signResponse{}, err
	}
	serial := hex.EncodeToString(serialBytes)
	days := input.ValidityDays
	if days <= 0 || days > 3970 {
		days = 90
	}
	command := exec.CommandContext(ctx, s.config.OpenSSLPath,
		"x509", "-req", "-in", csrPath, "-CA", s.config.CACertPath, "-CAkey", s.config.CAKeyPath,
		"-set_serial", "0x"+serial, "-days", fmt.Sprint(days), "-sha256", "-extfile", extPath, "-extensions", "leaf_ext", "-out", certPath,
	)
	if output, err := command.CombinedOutput(); err != nil {
		return signResponse{}, fmt.Errorf("openssl sign failed: %s", strings.TrimSpace(string(output)))
	}
	certificatePEM, err := os.ReadFile(certPath)
	if err != nil {
		return signResponse{}, err
	}
	block, _ := pem.Decode(certificatePEM)
	if block == nil {
		return signResponse{}, errors.New("无法解析签发证书")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return signResponse{}, err
	}
	chainPEM := certificatePEM
	chainPath := s.config.CAChainPath
	if chainPath == "" {
		chainPath = s.config.CACertPath
	}
	chain, err := os.ReadFile(chainPath)
	if err != nil {
		return signResponse{}, err
	}
	chainPEM = append(bytes.TrimSpace(chainPEM), '\n')
	chainPEM = append(chainPEM, bytes.TrimSpace(chain)...)
	chainPEM = append(chainPEM, '\n')
	publicKeyDER, err := x509.MarshalPKIXPublicKey(certificate.PublicKey)
	if err != nil {
		return signResponse{}, err
	}
	certHash := sha256.Sum256(certificate.Raw)
	keyHash := sha256.Sum256(publicKeyDER)
	return signResponse{
		CertificatePEM: string(certificatePEM), CertificateChainPEM: string(chainPEM), SerialNumber: serial,
		FingerprintSHA256: hex.EncodeToString(certHash[:]), PublicKeyFingerprintSHA256: hex.EncodeToString(keyHash[:]),
		NotBefore: certificate.NotBefore.UTC().Format(time.RFC3339), NotAfter: certificate.NotAfter.UTC().Format(time.RFC3339),
		ProviderRequestID: input.IdempotencyKey,
	}, nil
}

func (s *server) register() error {
	identity := sha256.Sum256([]byte(s.config.Name + "|" + runtime.GOOS + "|" + s.config.DataDir))
	payload := map[string]any{
		"token": s.config.EnrollmentToken, "name": s.config.Name, "platform": runtime.GOOS, "role": s.config.Role,
		"identityFingerprint": hex.EncodeToString(identity[:]), "keyBackend": s.config.KeyBackend,
		"exportability": s.config.Exportability, "endpoint": "http://" + s.config.ListenAddress, "version": "0.1.0",
		"capabilities": capabilities(),
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := s.post("/api/v1/ca-nodes/register", payload, &response); err != nil {
		return err
	}
	if response.ID == "" {
		return errors.New("控制面未返回 node id")
	}
	s.config.NodeID = response.ID
	return nil
}

func (s *server) controlPlaneLoop(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.heartbeatAndLease(); err != nil {
			log.Printf("控制面同步失败: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *server) heartbeatAndLease() error {
	if s.config.NodeID == "" {
		return nil
	}
	var heartbeat map[string]any
	if err := s.post("/api/v1/ca-nodes/heartbeat", map[string]any{
		"nodeId": s.config.NodeID, "healthStatus": "online", "role": s.config.Role, "capabilities": capabilities(), "version": "0.1.0",
	}, &heartbeat); err != nil {
		return err
	}
	var task map[string]any
	if err := s.post("/api/v1/ca-nodes/tasks/lease", map[string]any{"nodeId": s.config.NodeID}, &task); err != nil {
		return err
	}
	if len(task) == 0 || fmt.Sprint(task["id"]) == "" {
		return nil
	}
	return s.executeLeasedTask(task)
}

func (s *server) executeLeasedTask(task map[string]any) error {
	taskID := fmt.Sprint(task["id"])
	taskType := fmt.Sprint(task["taskType"])
	payload, _ := task["payload"].(map[string]any)
	result := map[string]any{"success": false, "nodeId": s.config.NodeID}
	if taskType == "health_check" {
		result["success"] = true
		result["result"] = map[string]any{"status": "ok"}
	} else if taskType == "sign_csr" {
		encoded, _ := json.Marshal(payload)
		var request signRequest
		if err := json.Unmarshal(encoded, &request); err == nil {
			issued, issueErr := s.signCSR(context.Background(), request)
			if issueErr == nil {
				result["success"] = true
				result["result"] = issued
			} else {
				result["errorCode"] = "CA_SIGN_FAILED"
				result["errorMessage"] = issueErr.Error()
			}
		}
	} else {
		result["errorCode"] = "CA_TASK_UNSUPPORTED"
		result["errorMessage"] = "unsupported task type"
	}
	return s.post("/api/v1/ca-nodes/tasks/"+taskID+"/result", result, &map[string]any{})
}

func (s *server) post(path string, payload any, output any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.config.ControlPlaneURL, "/")+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-tenant-id", s.config.TenantID)
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode >= 300 {
		return fmt.Errorf("control plane returned %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(bytes.TrimSpace(body)) == 0 || bytes.Equal(bytes.TrimSpace(body), []byte("null")) {
		return nil
	}
	return json.Unmarshal(body, output)
}

func (s *server) loadResults() error {
	content, err := os.ReadFile(filepath.Join(s.config.DataDir, "idempotency-results.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(content, &s.results)
}

func (s *server) saveResults() error {
	content, err := json.MarshalIndent(s.results, "", "  ")
	if err != nil {
		return err
	}
	temporary := filepath.Join(s.config.DataDir, "idempotency-results.json.tmp")
	final := filepath.Join(s.config.DataDir, "idempotency-results.json")
	if err := os.WriteFile(temporary, content, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, final)
}

func capabilities() map[string]bool {
	return map[string]bool{
		"discoverHierarchy": true, "createRoot": false, "createIntermediate": false, "signCsr": true,
		"queryIssuance": true, "revokeCertificate": true, "publishCrl": false, "ocsp": false,
		"listProfiles": false, "deviceLocalCsr": false, "hardwareBackedKey": false, "highAvailability": true,
	}
}

func extensionConfig(sans []string, usages []string) string {
	if len(usages) == 0 {
		usages = []string{"serverAuth"}
	}
	lines := []string{"[leaf_ext]", "basicConstraints = critical,CA:false", "subjectKeyIdentifier = hash", "authorityKeyIdentifier = keyid,issuer", "keyUsage = critical,digitalSignature,keyEncipherment", "extendedKeyUsage = " + strings.Join(usages, ",")}
	if len(sans) > 0 {
		values := make([]string, 0, len(sans))
		for _, value := range sans {
			kind := "DNS"
			if strings.Contains(value, ":") || isIPv4(value) {
				kind = "IP"
			}
			values = append(values, kind+":"+value)
		}
		lines = append(lines, "subjectAltName = "+strings.Join(values, ","))
	}
	return strings.Join(lines, "\n") + "\n"
}

func isIPv4(value string) bool {
	parts := strings.Split(value, ".")
	return len(parts) == 4
}

func decodeJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 4*1024*1024))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, map[string]any{"code": code, "message": message})
}

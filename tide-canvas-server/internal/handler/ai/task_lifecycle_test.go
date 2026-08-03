package ai

import (
	"testing"

	"tidecanvas/internal/model"
)

func TestTaskCanExecuteOnlyProcessing(t *testing.T) {
	if !taskCanExecute(&model.AiTask{Status: statusProcessing}) {
		t.Fatal("processing task was rejected")
	}
	for _, status := range []int{statusSuccess, statusFailed, statusCancelled} {
		if taskCanExecute(&model.AiTask{Status: status}) {
			t.Fatalf("terminal task status %d would still call provider", status)
		}
	}
}

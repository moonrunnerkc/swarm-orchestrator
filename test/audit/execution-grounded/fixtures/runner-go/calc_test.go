package calc

import "testing"

func TestAdd(t *testing.T) {
	if Add(1, 2) != 3 {
		t.Fatalf("Add(1,2)=0, want 3", Add(1, 2))
	}
}

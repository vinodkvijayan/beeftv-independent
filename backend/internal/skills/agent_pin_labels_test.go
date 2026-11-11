package skills

import "testing"

func TestValidateAgentSkillsCapturesDisplayLabels(t *testing.T) {
	s, _ := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "---\nname: Short drama asset batching process\ndescription: label test\n---\nText"})
	spoofed := pin
	spoofed.SkillName = "fake name"
	spoofed.Version = "99"
	pins, err := s.ValidateAgentSkills("owner", []Pin{spoofed})
	if err != nil || len(pins) != 1 {
		t.Fatalf("pins=%+v err=%v", pins, err)
	}
	resource, err := s.AgentVersion("owner", pin)
	if err != nil {
		t.Fatal(err)
	}
	got := pins[0]
	if got.Identity() != pin || got.SkillName != resource.Name || got.Version != resource.Version || got.SkillName == "fake name" || got.SkillName == "" {
		t.Fatalf("validated pin must carry the installed name and version: %+v resource=%s/%s", got, resource.Name, resource.Version)
	}
	if again, err := s.AgentVersion("owner", got); err != nil || again.Pin != pin {
		t.Fatalf("labels must not leak into the package identity: %+v %v", again, err)
	}
}

package demo.fixture;
import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
public class MainActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        Button button = new Button(this);
        button.setText("Save note");
        button.setOnClickListener(view -> saveNote("fixture text"));
        setContentView(button);
    }
    private void saveNote(String text) {
        getSharedPreferences("notes", MODE_PRIVATE).edit().putString("last", text).apply();
    }
    // An intentional analysis boundary; no native implementation is supplied.
    public native String nativeSummarize(String text);
}

package vendor.sdk;
public class Unused {
    public String label() { return "Save note"; }
    public Object dynamic(String className) throws Exception {
        return Class.forName(className).getDeclaredConstructor().newInstance();
    }
}
